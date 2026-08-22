"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import NextLink from "next/link";
import { LAlert, LCard, LSeparator, lButtonClass } from "@/components/ledger";
import { LField, LInput, LSelect, LTextarea, LCheckbox } from "@/components/ledger/forms";
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
  const formRef = useRef<HTMLFormElement>(null);

  // F: focus + scroll the first invalid control whenever a fresh
  // fieldErrors map arrives, so a bad field several sections up isn't
  // just a message next to the submit button. Queried in DOCUMENT order
  // (first aria-invalid control in the form) rather than by iterating
  // fieldErrors' keys — object key order is INSERTION order, which is
  // parseClientForm's check order, not the field's position on the page;
  // a field near the top whose check happens to run last would otherwise
  // be left off-screen while the page scrolled to one further down.
  useEffect(() => {
    if (!state.fieldErrors) return;
    const el = formRef.current?.querySelector('[aria-invalid="true"]');
    if (!(el instanceof HTMLElement)) return;
    el.focus();
    el.scrollIntoView({ block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.fieldErrors]);

  // F: unsaved-changes protection. Any change anywhere in the form (a
  // single onChange on the <form> catches every descendant control via
  // React's bubbling) arms a beforeunload warning; a full page unload —
  // refresh, close, back out of the app — is the loss this guards, not
  // in-app navigation, which the App Router never fires it for anyway.
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

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

  // Every LSelect below is a REAL native <select>, so it is genuinely
  // controlled by React's own `value` prop — no bubble-input quirk to work
  // around here, unlike the Radix Select.Root this form used to post
  // through. The hidden-input-plus-remount pattern that quirk required is
  // kept anyway, deliberately unchanged, rather than simplified away: this
  // pass is a skin swap, and the posting mechanism is proven behavior this
  // brief keeps untouched (docs/design/LEDGER.md's migration rule).
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
    <LCard>
      <form ref={formRef} action={formAction} onChange={() => setDirty(true)}>
        {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

        <h2 className="mb-3 text-h3 font-semibold">Who they are</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <LField
            label="Client name"
            htmlFor="name"
            hint="The name that prints on their invoices"
            error={state.fieldErrors?.name}
            errorId="name-error"
          >
            <LInput
              id="name"
              name="name"
              required
              defaultValue={initial("name", values.name)}
              aria-invalid={state.fieldErrors?.name ? true : undefined}
              aria-describedby={state.fieldErrors?.name ? "name-error" : undefined}
            />
          </LField>
          <LField label="Contact" htmlFor="contact_name">
            <LInput
              id="contact_name"
              name="contact_name"
              defaultValue={initial("contact_name", values.contact_name)}
            />
          </LField>
          <LField
            label="Contact email"
            htmlFor="contact_email"
            hint="Where a platform-sent invoice goes"
            error={state.fieldErrors?.contact_email}
            errorId="contact_email-error"
          >
            <LInput
              id="contact_email"
              type="email"
              name="contact_email"
              defaultValue={initial("contact_email", values.contact_email)}
              aria-invalid={state.fieldErrors?.contact_email ? true : undefined}
              aria-describedby={state.fieldErrors?.contact_email ? "contact_email-error" : undefined}
            />
          </LField>
          <LField label="Contact phone" htmlFor="contact_phone">
            <LInput
              id="contact_phone"
              name="contact_phone"
              defaultValue={initial("contact_phone", values.contact_phone)}
            />
          </LField>
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <span id={`${operatingRuleId}-label`} className="text-body-s font-medium text-ink">
              Operating rule
            </span>
            <LSelect
              key={`operating-rule-${genTick}`}
              id={operatingRuleId}
              aria-labelledby={`${operatingRuleId}-label`}
              value={operatingRule}
              onChange={(e) => setOperatingRule(e.target.value)}
            >
              {CLIENT_OPERATING_RULES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </LSelect>
            <input type="hidden" name="operating_rule" value={operatingRule} />
            <p className="text-caption text-ink-3">
              Which 14 CFR part this client&rsquo;s work is flown under. Controls whether the
              Part 135 checks (135.293/.297/.299) below show up for this client, and seeds
              (but doesn&rsquo;t fix) the operating rule on every new trip for them.
            </p>
          </div>
        </div>

        <h2 className="mt-5 mb-3 text-h3 font-semibold">Billing address</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
          <LField label="Address" htmlFor="address_line1" className="md:col-span-3">
            <LInput
              id="address_line1"
              name="address_line1"
              defaultValue={initial("address_line1", values.address_line1)}
            />
          </LField>
          <LField label="Address line 2" htmlFor="address_line2" className="md:col-span-3">
            <LInput
              id="address_line2"
              name="address_line2"
              defaultValue={initial("address_line2", values.address_line2)}
            />
          </LField>
          <LField label="City" htmlFor="city" className="md:col-span-2">
            <LInput id="city" name="city" defaultValue={initial("city", values.city)} />
          </LField>
          <LField label="State" htmlFor="state" className="md:col-span-1">
            <LInput id="state" name="state" defaultValue={initial("state", values.state)} />
          </LField>
          <LField label="Postal code" htmlFor="postal_code" className="md:col-span-2">
            <LInput
              id="postal_code"
              name="postal_code"
              defaultValue={initial("postal_code", values.postal_code)}
            />
          </LField>
          <LField label="Country" htmlFor="country" className="md:col-span-1">
            <LInput id="country" name="country" defaultValue={initial("country", values.country)} />
          </LField>
        </div>

        <h2 className="mt-5 mb-3 text-h3 font-semibold">Rate agreement</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <LField
            label="Day rate (USD)"
            htmlFor="default_day_rate"
            error={state.fieldErrors?.default_day_rate}
            errorId="default_day_rate-error"
          >
            <LInput
              id="default_day_rate"
              name="default_day_rate"
              inputMode="decimal"
              className="tnum-l"
              defaultValue={initial(
                "default_day_rate",
                centsToInput(values.default_day_rate_cents)
              )}
              aria-invalid={state.fieldErrors?.default_day_rate ? true : undefined}
              aria-describedby={
                state.fieldErrors?.default_day_rate ? "default_day_rate-error" : undefined
              }
            />
          </LField>
          <LField
            label="Per diem (USD)"
            htmlFor="default_per_diem"
            error={state.fieldErrors?.default_per_diem}
            errorId="default_per_diem-error"
          >
            <LInput
              id="default_per_diem"
              name="default_per_diem"
              inputMode="decimal"
              className="tnum-l"
              defaultValue={initial(
                "default_per_diem",
                centsToInput(values.default_per_diem_cents)
              )}
              aria-invalid={state.fieldErrors?.default_per_diem ? true : undefined}
              aria-describedby={
                state.fieldErrors?.default_per_diem ? "default_per_diem-error" : undefined
              }
            />
          </LField>
          <LField
            label="Travel day rate (USD)"
            htmlFor="default_travel_day_rate"
            hint="Days getting to or from the aircraft"
            error={state.fieldErrors?.default_travel_day_rate}
            errorId="default_travel_day_rate-error"
          >
            <LInput
              id="default_travel_day_rate"
              name="default_travel_day_rate"
              inputMode="decimal"
              className="tnum-l"
              defaultValue={initial(
                "default_travel_day_rate",
                centsToInput(values.default_travel_day_rate_cents)
              )}
              aria-invalid={state.fieldErrors?.default_travel_day_rate ? true : undefined}
              aria-describedby={
                state.fieldErrors?.default_travel_day_rate
                  ? "default_travel_day_rate-error"
                  : undefined
              }
            />
          </LField>
          <LField
            label="Payment terms (days)"
            htmlFor="payment_terms_days"
            hint="Net 30 unless you agreed otherwise"
            error={state.fieldErrors?.payment_terms_days}
            errorId="payment_terms_days-error"
          >
            <LInput
              id="payment_terms_days"
              type="number"
              name="payment_terms_days"
              className="tnum-l"
              defaultValue={initial("payment_terms_days", values.payment_terms_days, "30")}
              aria-invalid={state.fieldErrors?.payment_terms_days ? true : undefined}
              aria-describedby={
                state.fieldErrors?.payment_terms_days ? "payment_terms_days-error" : undefined
              }
            />
          </LField>
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <span id={`${expenseTreatmentId}-label`} className="text-body-s font-medium text-ink">
              Expenses on this client&rsquo;s trips
            </span>
            <LSelect
              key={`expense-treatment-${genTick}`}
              id={expenseTreatmentId}
              aria-labelledby={`${expenseTreatmentId}-label`}
              value={expenseTreatment}
              onChange={(e) => setExpenseTreatment(e.target.value)}
            >
              {TREATMENTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </LSelect>
            <input type="hidden" name="default_expense_treatment" value={expenseTreatment} />
          </div>
          <div className="flex flex-col gap-1.5 md:col-span-3">
            <span id={`${w9StatusId}-label`} className="text-body-s font-medium text-ink">
              W-9
            </span>
            <LSelect
              key={`w9-status-${genTick}`}
              id={w9StatusId}
              aria-labelledby={`${w9StatusId}-label`}
              value={w9Status}
              onChange={(e) => setW9Status(e.target.value)}
            >
              {W9_STATUSES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </LSelect>
            <input type="hidden" name="w9_status" value={w9Status} />
          </div>
          <LField label="Notes" htmlFor="notes" className="md:col-span-3">
            <LTextarea
              id="notes"
              name="notes"
              rows={3}
              defaultValue={initial("notes", values.notes)}
            />
          </LField>
          {/* 20260815120000. Sits in the rate agreement block because that
              is the block about money, and this is the switch that says
              whether there is any. Posted through a controlled hidden
              input for the same React 19 reason every other control on
              this form is: an uncontrolled checkbox loses its state on
              every action dispatch, the rejected one included. */}
          <div className="flex flex-col gap-1.5 md:col-span-3">
            <label className="flex items-center gap-2 text-body-s font-medium text-ink">
              <LCheckbox
                checked={youInvoice}
                onChange={(e) => setYouInvoice(e.target.checked)}
              />
              {COUNTERPARTY_COPY.toggleLabel}
            </label>
            <input type="hidden" name="you_invoice" value={youInvoice ? "1" : ""} />
            <p className="text-caption text-ink-3">{COUNTERPARTY_COPY.toggleHelp}</p>
          </div>
        </div>

        <h2 className="mt-5 mb-3 text-h3 font-semibold">Contract terms</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <span id={`${perDiemModeId}-label`} className="text-body-s font-medium text-ink">
              Meals
            </span>
            <LSelect
              key={`per-diem-mode-${genTick}`}
              id={perDiemModeId}
              aria-labelledby={`${perDiemModeId}-label`}
              value={perDiemMode}
              onChange={(e) => setPerDiemMode(e.target.value)}
            >
              {PER_DIEM_MODES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </LSelect>
            <input type="hidden" name="per_diem_mode" value={perDiemMode} />
            {/* F3: the old copy read as unconditional. Per diem only
                reaches the invoice draft for a trip whose day grid has
                been filled in and saved — createInvoiceDraft has no
                per-diem count to draw on otherwise, so a trip without one
                still falls back to expecting meal receipts regardless of
                this setting. */}
            <p className="text-caption text-ink-3">
              Adds a per-diem line on trips whose day grid has been filled
              in. A trip without one still expects meal receipts.
            </p>
          </div>
          <LField
            label="Minimum (days)"
            htmlFor="minimum_days"
            error={state.fieldErrors?.minimum_days}
            errorId="minimum_days-error"
          >
            {/* F4: "Contract minimum" reads, to most pilots, as the OTHER
                minimum this industry uses — a full day rate regardless of
                hours flown — which this product already honors for free
                by billing in whole days. What this field actually sets is
                the other one: a floor on the total days billed. Which
                total it's a floor ON is minimum_basis, right below. */}
            <LInput
              id="minimum_days"
              name="minimum_days"
              inputMode="decimal"
              className="tnum-l"
              defaultValue={initial("minimum_days", values.minimum_days)}
              aria-invalid={state.fieldErrors?.minimum_days ? true : undefined}
              aria-describedby={state.fieldErrors?.minimum_days ? "minimum_days-error" : undefined}
            />
          </LField>
          <div className="flex flex-col gap-1.5">
            {/* Bug fix (see MINIMUM_BASES above): this used to be an
                unstated assumption, always "per trip" because that was
                the only thing createInvoiceDraft could do with the number
                above. Now it's an explicit choice, worded the way a pilot
                describes their own deal rather than the schema's
                vocabulary. */}
            <label htmlFor={minimumBasisId} className="text-body-s font-medium text-ink">
              Applies
            </label>
            <LSelect
              key={`minimum_basis-${genTick}`}
              id={minimumBasisId}
              value={minimumBasis}
              onChange={(e) => setMinimumBasis(e.target.value)}
            >
              {MINIMUM_BASES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </LSelect>
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
            <p className="text-caption text-ink-3">
              {minimumBasis === "per_month"
                ? "Four 3-day trips in a month for a client with a 10-day monthly guarantee bill one top-up line for the month, not four."
                : "A 1-day trip for a client with a 2-day minimum bills 2 days, on every trip that falls short."}
            </p>
          </div>
          <LField
            label="Cancellation terms"
            htmlFor="cancellation_policy_note"
            className="md:col-span-2"
            hint="Recorded for reference only, not applied automatically. Add the fee line yourself if the client owes one."
          >
            <LTextarea
              id="cancellation_policy_note"
              name="cancellation_policy_note"
              rows={2}
              defaultValue={initial("cancellation_policy_note", values.cancellation_policy_note)}
            />
          </LField>
        </div>

        <div className="mt-5 mb-3 flex flex-col gap-1">
          <h2 className="text-h3 font-semibold">Chasing this client</h2>
          {/* SAYS PLAINLY THAT MAIL LEAVES THE BUILDING. This is the only
              screen in the product where a pilot arms something that emails
              their client without them, so it names the client, says nothing
              is on by default, and says where to stop it. */}
          <p className="text-body-s text-ink-2">
            Reminders email the contact above in your name, invoice
            attached: the same follow-up you could send by hand. Nothing is
            on until you tick it, and any single invoice can opt out from
            its own page.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="flex flex-col gap-1">
            <span className="text-body-s font-medium text-ink">Before it&rsquo;s due</span>
            <div className="mt-1 flex flex-col gap-1">
              {REMINDER_BEFORE_DAYS.map((day) => (
                <label key={`before-${day}`} className="flex items-center gap-2 text-body-s text-ink">
                  <LCheckbox
                    checked={beforeDue.includes(day)}
                    onChange={() => toggleDay(day, beforeDue, setBeforeDue)}
                  />
                  {day} days before
                </label>
              ))}
            </div>
            <input type="hidden" name="reminder_before_due" value={beforeDue.join(",")} />
            <p className="text-caption text-ink-3">
              A courtesy note while there is still time to pay it.
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-body-s font-medium text-ink">On the due date</span>
            <label className="mt-1 flex items-center gap-2 text-body-s text-ink">
              <LCheckbox checked={onDue} onChange={(e) => setOnDue(e.target.checked)} />
              Send one on the day
            </label>
            <input type="hidden" name="reminder_on_due" value={onDue ? "1" : ""} />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-body-s font-medium text-ink">After it&rsquo;s due</span>
            <div className="mt-1 flex flex-col gap-1">
              {REMINDER_AFTER_DAYS.map((day) => (
                <label key={`after-${day}`} className="flex items-center gap-2 text-body-s text-ink">
                  <LCheckbox
                    checked={afterDue.includes(day)}
                    onChange={() => toggleDay(day, afterDue, setAfterDue)}
                  />
                  {day} days past due
                </label>
              ))}
            </div>
            <input type="hidden" name="reminder_after_due" value={afterDue.join(",")} />
          </div>

          <div className="md:col-span-3">
            {/* THE THREE THINGS A PILOT WOULD OTHERWISE FIND OUT BY WATCHING.
                Each is a real rule in lib/reminders/policy.ts, not a
                reassurance: one send per invoice per run, a quiet period after
                any chase (yours included), and a pause when the client has
                just opened the link. */}
            <p className="text-caption text-ink-3">
              One reminder per invoice per day: when several are due, the
              most recent is sent and the rest are skipped, not queued.
              Nothing goes out within five days of any chase, yours included,
              or just after the client has opened the invoice. Paid and
              voided invoices are never chased.
            </p>
          </div>
        </div>

        <div className="mt-5 mb-3 flex flex-col gap-1">
          <h2 className="text-h3 font-semibold">Late fee</h2>
          {/* THE DOMAIN RULE, IN THE COPY. A late fee is a term the pilot
              negotiated, not something this product works out they are owed —
              so the heading is neutral, the wording says "you agreed", and the
              default is none. */}
          <p className="text-body-s text-ink-2">
            Only if you agreed one with this client. This product never adds a
            fee on its own: when one is due it offers you a separate draft
            invoice, which you review and send like any other.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={lateFeeKindId} className="text-body-s font-medium text-ink">
              What you agreed
            </label>
            <LSelect
              key={`late-fee-kind-${genTick}`}
              id={lateFeeKindId}
              value={lateFeeKind}
              onChange={(e) => setLateFeeKind(e.target.value)}
            >
              {LATE_FEE_KINDS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </LSelect>
            <input type="hidden" name="late_fee_kind" value={lateFeeKind} />
          </div>

          {lateFeeKind === "flat" ? (
            <LField
              label="Amount (USD)"
              htmlFor="late_fee_flat"
              hint="Charged once, not every month."
              error={state.fieldErrors?.late_fee_flat}
              errorId="late_fee_flat-error"
            >
              <LInput
                id="late_fee_flat"
                name="late_fee_flat"
                inputMode="decimal"
                className="tnum-l"
                defaultValue={initial(
                  "late_fee_flat",
                  centsToInput(values.late_fee_flat_cents)
                )}
                aria-invalid={state.fieldErrors?.late_fee_flat ? true : undefined}
                aria-describedby={
                  state.fieldErrors?.late_fee_flat ? "late_fee_flat-error" : undefined
                }
              />
            </LField>
          ) : null}

          {lateFeeKind === "rate" ? (
            <LField
              label="Percent per month"
              htmlFor="late_fee_rate_percent"
              hint="1.5% is the common convention. The fee applies to the balance still outstanding, charged per complete month, up to a cap of 5%."
              error={state.fieldErrors?.late_fee_rate_percent}
              errorId="late_fee_rate_percent-error"
            >
              <LInput
                id="late_fee_rate_percent"
                name="late_fee_rate_percent"
                inputMode="decimal"
                className="tnum-l"
                defaultValue={initial(
                  "late_fee_rate_percent",
                  values.late_fee_bps_per_month == null
                    ? ""
                    : String(values.late_fee_bps_per_month / 100)
                )}
                aria-invalid={state.fieldErrors?.late_fee_rate_percent ? true : undefined}
                aria-describedby={
                  state.fieldErrors?.late_fee_rate_percent ? "late_fee_rate_percent-error" : undefined
                }
              />
            </LField>
          ) : null}

          <LField
            label="Grace period (days)"
            htmlFor="late_fee_grace_days"
            hint="Days past due before anything starts running."
            error={state.fieldErrors?.late_fee_grace_days}
            errorId="late_fee_grace_days-error"
          >
            <LInput
              id="late_fee_grace_days"
              type="number"
              name="late_fee_grace_days"
              className="tnum-l"
              defaultValue={initial(
                "late_fee_grace_days",
                values.late_fee_grace_days,
                "0"
              )}
              aria-invalid={state.fieldErrors?.late_fee_grace_days ? true : undefined}
              aria-describedby={
                state.fieldErrors?.late_fee_grace_days ? "late_fee_grace_days-error" : undefined
              }
            />
          </LField>

          {lateFeeKind !== "none" ? (
            <div className="flex flex-col gap-1.5 md:col-span-3">
              <LSeparator className="my-1" />
              <label className="flex items-center gap-2 text-body-s text-ink">
                <LCheckbox
                  checked={lateFeeNote}
                  onChange={(e) => setLateFeeNote(e.target.checked)}
                />
                Mention it in reminders to this client
              </label>
              <input
                type="hidden"
                name="late_fee_note_on_reminders"
                value={lateFeeNote ? "1" : ""}
              />
              {/* SAYS EXACTLY WHAT THE CLIENT WOULD READ, because "mention it"
                  could mean anything and this is a sentence going to somebody
                  else's accounts department in the pilot's name. */}
              <p className="text-caption text-ink-3">
                Adds one line to reminders: &ldquo;Per our agreement, a late fee
                of {lateFeeKind === "flat" ? "$X" : "X% per month"} applies on
                balances more than N days past their due date.&rdquo; It states
                the term only. There is no running total, and it is never
                shown as part of the amount due.
              </p>
            </div>
          ) : null}
        </div>

        {/* role="alert" so a screen reader hears the rejection; without it
            the form silently resets and nothing is announced. */}
        <div className="mt-4" role="alert" aria-live="polite">
          {state.error ? <LAlert tone="crit">{state.error}</LAlert> : null}
        </div>

        <div className="mt-5 flex gap-3">
          <button type="submit" disabled={pending} className={lButtonClass({ variant: "primary" })}>
            {pending ? "Saving…" : submitLabel}
          </button>
          <NextLink href="/clients" className={lButtonClass({ variant: "outline" })}>
            Cancel
          </NextLink>
        </div>
      </form>
    </LCard>
  );
}

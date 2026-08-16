"use client";

import { useActionState, useState } from "react";
import { LAlert, LButton, LCard, LSeparator, LSpinner } from "@/components/ledger";
import { LInput, LSelect } from "@/components/ledger/forms";
import { cn } from "@/lib/ledger/cn";
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
    hint: "For your own records. Never shared or shown to clients.",
  },
  {
    short: "Rates",
    title: "Rates & billing",
    hint: "Defaults that pre-fill each new trip and invoice. Change any of them per client later.",
  },
] as const;

/**
 * LEDGER PASS: this file was rewritten onto Ledger's primitives
 * (docs/design/LEDGER.md) — the two mechanics that must survive any future
 * pass are unchanged from the Radix version:
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
    <div className="flex flex-col gap-4">
      <Stepper current={step} onSelect={setStep} disabled={pending} />

      <LCard className="p-6 sm:p-8">
        <form action={formAction}>
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <h1 className="text-h2 font-bold text-ink">{current.title}</h1>
              <p className="text-body-s text-ink-2">{current.hint}</p>
            </div>

            {/* All three panels stay mounted (display toggles only) so a
                single submit carries every field regardless of which step
                is showing. */}

            {/* Step 1 — Business identity */}
            <div className={step === 0 ? "block" : "hidden"}>
              <div className="flex flex-col gap-5">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                  <Field
                    span={8}
                    id="legal_name"
                    label={kind === "business" ? "Business name" : "Your name / business name"}
                    hint="Appears as the payee on every invoice"
                  >
                    <LInput id="legal_name" name="legal_name" required disabled={pending} defaultValue={initial("legal_name")} />
                  </Field>
                  <Field span={4} id="dba_name" label="Doing business as" hint="Only if it differs from above">
                    <LInput id="dba_name" name="dba_name" disabled={pending} defaultValue={initial("dba_name")} />
                  </Field>
                  <Field span={6} id="phone" label="Phone">
                    <LInput id="phone" name="phone" type="tel" autoComplete="tel" disabled={pending} defaultValue={initial("phone")} />
                  </Field>
                  <Field span={6} id="home_base" label="Based airport">
                    <LInput id="home_base" name="home_base" placeholder="KTEB" disabled={pending} defaultValue={initial("home_base")} />
                  </Field>
                </div>

                <GroupHeading>Address</GroupHeading>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                  <Field span={12} id="address_line1" label="Address">
                    <LInput id="address_line1" name="address_line1" autoComplete="address-line1" disabled={pending} defaultValue={initial("address_line1")} />
                  </Field>
                  <Field span={12} id="address_line2" label="Address line 2">
                    <LInput id="address_line2" name="address_line2" autoComplete="address-line2" disabled={pending} defaultValue={initial("address_line2")} />
                  </Field>
                  <Field span={5} id="city" label="City">
                    <LInput id="city" name="city" autoComplete="address-level2" disabled={pending} defaultValue={initial("city")} />
                  </Field>
                  <Field span={3} id="state" label="State">
                    <LInput id="state" name="state" autoComplete="address-level1" disabled={pending} defaultValue={initial("state")} />
                  </Field>
                  <Field span={4} id="postal_code" label="Postal code">
                    <LInput id="postal_code" name="postal_code" autoComplete="postal-code" disabled={pending} defaultValue={initial("postal_code")} />
                  </Field>
                  <Field span={12} id="country" label="Country">
                    <LInput id="country" name="country" autoComplete="country-name" disabled={pending} defaultValue={initial("country")} />
                  </Field>
                </div>
              </div>
            </div>

            {/* Step 2 — Airman profile */}
            <div className={step === 1 ? "block" : "hidden"}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                <div className="flex flex-col gap-1.5 sm:col-span-6">
                  {/* NOT a native <label htmlFor>: the certificate select is
                      followed by a hidden mirror input carrying the actual
                      posted value (NO_CERTIFICATE → ""), so this text names
                      the group by aria-labelledby the same way the account-
                      type toggle on /signup does. */}
                  <span id="certificate-type-label" className="text-body-s font-medium text-ink">
                    Certificate held
                  </span>
                  {/* Options come from lib/airman.ts — the one 14 CFR
                      61.5(a)(1) list, shared with the action's membership
                      check and the Settings panel. The select itself is
                      display-only (no name); the hidden input below is what
                      actually posts, translating NO_CERTIFICATE to "". */}
                  <LSelect
                    aria-labelledby="certificate-type-label"
                    value={certType}
                    onChange={(e) => setCertType(e.target.value)}
                    disabled={pending}
                  >
                    {CERTIFICATE_OPTIONS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </LSelect>
                  <input
                    type="hidden"
                    name="certificate_type"
                    value={certType === NO_CERTIFICATE ? "" : certType}
                  />
                </div>
                <Field span={6} id="certificate_number" label="Certificate number">
                  <LInput id="certificate_number" name="certificate_number" disabled={pending} defaultValue={initial("certificate_number")} />
                </Field>
                <Field
                  span={12}
                  id="ratings"
                  label="Ratings & type ratings"
                  hint="As written on your certificate, e.g. AMEL, Instrument Airplane, CE-525S"
                >
                  <LInput id="ratings" name="ratings" disabled={pending} defaultValue={initial("ratings")} />
                </Field>
              </div>
            </div>

            {/* Step 3 — Rates & billing defaults */}
            <div className={step === 2 ? "block" : "hidden"}>
              <div className="flex flex-col gap-5">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                  <Field span={6} id="default_day_rate" label="Default day rate" hint="Per duty day flown">
                    <AffixedInput id="default_day_rate" name="default_day_rate" inputMode="decimal" placeholder="1,200" disabled={pending} defaultValue={initial("default_day_rate")} prefix="$" />
                  </Field>
                  <Field span={6} id="default_travel_day_rate" label="Travel day rate" hint="Often half to full day rate, your call">
                    <AffixedInput id="default_travel_day_rate" name="default_travel_day_rate" inputMode="decimal" placeholder="600" disabled={pending} defaultValue={initial("default_travel_day_rate")} prefix="$" />
                  </Field>
                  <Field span={6} id="default_per_diem" label="Per diem" hint="Daily, when you bill per diem instead of receipts">
                    <AffixedInput id="default_per_diem" name="default_per_diem" inputMode="decimal" placeholder="75" disabled={pending} defaultValue={initial("default_per_diem")} prefix="$" />
                  </Field>
                </div>

                <GroupHeading>Invoicing</GroupHeading>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                  <Field span={4} id="default_payment_terms_days" label="Payment terms" hint="Net days">
                    <AffixedInput id="default_payment_terms_days" name="default_payment_terms_days" inputMode="numeric" placeholder="30" disabled={pending} defaultValue={initial("default_payment_terms_days")} suffix="days" />
                  </Field>
                  <Field span={4} id="invoice_prefix" label="Invoice prefix" hint="Leads every invoice number">
                    <LInput id="invoice_prefix" name="invoice_prefix" placeholder="INV" disabled={pending} defaultValue={initial("invoice_prefix")} />
                  </Field>
                </div>

                <p className="text-body-s text-ink-2">
                  That&rsquo;s everything. All of it is editable later in
                  Settings.
                </p>
              </div>
            </div>

            {/* The live region is always present, so its first message is
                announced; only the contents change. */}
            <div role="alert" aria-live="polite">
              {state.error ? (
                <LAlert tone="crit" className="flex items-start gap-2">
                  <WarningIcon className="mt-0.5 shrink-0 text-crit" />
                  <span>{state.error}</span>
                </LAlert>
              ) : null}
            </div>

            <LSeparator className="my-0" />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <LButton
                type="button"
                variant="outline"
                disabled={step === 0 || pending}
                onClick={() => setStep((s) => Math.max(0, s - 1))}
              >
                Back
              </LButton>

              <div className="flex items-center gap-3">
                {/* Skip is a real submit (intent=skip): it marks onboarding
                    done and drops the pilot into the app without collecting
                    anything. Everything here is editable later in
                    Settings. */}
                <LButton
                  type="submit"
                  name="intent"
                  value="skip"
                  variant="quiet"
                  disabled={pending}
                >
                  Skip for now
                </LButton>

                {isLast ? (
                  <LButton type="submit" name="intent" value="finish" disabled={pending}>
                    {pending ? (
                      <>
                        <LSpinner className="border-accent-ink/40 border-t-accent-ink" />
                        Finishing…
                      </>
                    ) : (
                      "Finish setup"
                    )}
                  </LButton>
                ) : (
                  <LButton
                    type="button"
                    disabled={pending}
                    onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
                  >
                    Next
                  </LButton>
                )}
              </div>
            </div>
          </div>
        </form>
      </LCard>
    </div>
  );
}

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M8 2 14.25 13H1.75Z" />
      <path d="M8 6.25v3" />
      <circle cx="8" cy="11.25" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M3 8.5 6.5 12 13 4" />
    </svg>
  );
}

/**
 * The stepper. It shows all three steps, which one is current, and which
 * are already behind. Every panel is mounted the whole time and there is
 * exactly one submit at the end, so jumping between them cannot lose a
 * field or skip a validation — it is a view switch, not a wizard state
 * machine. `min-h-11` on the button keeps the 44px touch-target floor the
 * old Radix version stated by hand.
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
    <ol className="flex w-full items-center gap-2">
      {STEPS.map((s, index) => {
        const done = index < current;
        const active = index === current;
        const isLast = index === STEPS.length - 1;
        return (
          <li key={s.short} className={cn("flex items-center gap-2", !isLast && "flex-1")}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSelect(index)}
              aria-current={active ? "step" : undefined}
              className="flex min-h-11 shrink-0 items-center gap-2 rounded-control px-1 disabled:pointer-events-none disabled:opacity-60"
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-caption font-bold",
                  done || active ? "bg-accent text-accent-ink" : "bg-sunk text-ink-2"
                )}
              >
                {done ? <CheckIcon /> : index + 1}
              </span>
              <span
                className={cn(
                  "text-body-s",
                  active ? "font-medium text-ink" : "text-ink-2"
                )}
              >
                {s.short}
              </span>
            </button>

            {!isLast ? (
              <span aria-hidden className={cn("h-px flex-1", done ? "bg-accent" : "bg-hair")} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** A rule with a label on it — what separates one group of fields from the
 *  next inside a step that is too tall to read as a single list. */
function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-caption font-medium text-ink-3">
        {String(children).toUpperCase()}
      </span>
      <div className="h-px flex-1 bg-hair" />
    </div>
  );
}

/** Grid-cell span, as literal Tailwind classes so the compiler's static
 *  scan can see every one — a template-built `sm:col-span-${n}` string
 *  would never be generated. */
const SPAN_CLASS: Record<number, string> = {
  3: "sm:col-span-3",
  4: "sm:col-span-4",
  5: "sm:col-span-5",
  6: "sm:col-span-6",
  8: "sm:col-span-8",
  12: "sm:col-span-12",
};

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
    <div className={cn("flex flex-col gap-1.5", SPAN_CLASS[span] ?? "sm:col-span-12")}>
      <label htmlFor={id} className="text-body-s font-medium text-ink">
        {label}
      </label>
      {children}
      {hint ? <p className="text-caption text-ink-3">{hint}</p> : null}
    </div>
  );
}

/** An LInput with a fixed prefix or suffix glyph ("$", "days") overlaid in
 *  its own padding — the Ledger equivalent of Radix's TextField.Slot. */
function AffixedInput({
  prefix,
  suffix,
  className,
  ...props
}: { prefix?: string; suffix?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      {prefix ? (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-body text-ink-3">
          {prefix}
        </span>
      ) : null}
      <LInput
        className={cn(prefix && "pl-7", suffix && "pr-12", className)}
        {...props}
      />
      {suffix ? (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-body-s text-ink-3">
          {suffix}
        </span>
      ) : null}
    </div>
  );
}

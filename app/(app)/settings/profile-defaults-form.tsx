"use client";

import { useActionState, useId, useState } from "react";
import { LButton, LCard } from "@/components/ledger";
import { LField, LInput, LSelect } from "@/components/ledger/forms";
import { CERTIFICATE_OPTIONS, NO_CERTIFICATE } from "@/lib/airman";
import { updateProfileDefaults, type SettingsFormState } from "./actions";

/**
 * All plain strings, built server-side by settings/page.tsx exactly the
 * way onboarding/page.tsx builds OnboardingValues: money already through
 * centsToInput, terms already String()ed. Passing raw cents here and
 * letting a generic initial() String()-coerce them would render a $1,200
 * day rate as "120000" — the field names carry no _cents suffix because
 * they hold dollar TEXT; the action maps them onto the *_cents columns.
 */
export type ProfileDefaultsValues = {
  dba_name: string;
  phone: string;
  home_base: string;
  certificate_type: string;
  certificate_number: string;
  ratings: string;
  default_day_rate: string;
  default_travel_day_rate: string;
  default_per_diem: string;
  default_payment_terms_days: string;
};

const initialState: SettingsFormState = { error: null };

/**
 * The rest of what the onboarding wizard collects — airman profile and the
 * account-level billing defaults — editable after first run, honoring the
 * wizard's "everything here is editable later in Settings" promise.
 * Mirrors settings-form.tsx: echoed submit wins over stored values (React
 * 19 resets uncontrolled forms on every dispatch, error path included),
 * owner-gated with the same non-owner sentence.
 */
export default function ProfileDefaultsForm({
  values,
  canEdit,
}: {
  values: ProfileDefaultsValues;
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    updateProfileDefaults,
    initialState
  );

  const submitted = state.values;
  const initial = (key: keyof ProfileDefaultsValues) => {
    const echoed = submitted?.[key];
    if (echoed !== undefined) return echoed;
    return values[key];
  };

  // LSelect (components/ledger/forms.tsx) is a native <select>, but this
  // field still needs the hidden-input translation the Radix-based wizard
  // established: NO_CERTIFICATE is a UI-only "prefer not to say" sentinel
  // that has to post as "" (→ NULL) rather than as its own literal value,
  // and this control has to survive React 19's per-dispatch uncontrolled
  // form reset the same way every other field on this form does. So the
  // visible LSelect carries no `name` at all — only the hidden input does,
  // same pattern as invoices/bill-to-fields.tsx's own picker.
  const [certType, setCertType] = useState(
    values.certificate_type === "" ? NO_CERTIFICATE : values.certificate_type
  );
  const certTypeId = useId();

  return (
    <LCard>
      <form action={formAction}>
        <div className="flex flex-col gap-4">
          <h2 className="text-h3 font-semibold">Profile &amp; billing defaults</h2>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="md:col-span-6">
              <LField
                label="Doing business as"
                htmlFor="dba_name"
                hint="Only if it differs from your business name"
              >
                <LInput
                  id="dba_name"
                  name="dba_name"
                  disabled={!canEdit}
                  defaultValue={initial("dba_name")}
                />
              </LField>
            </div>
            <div className="md:col-span-3">
              <LField label="Phone" htmlFor="phone">
                <LInput
                  id="phone"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  disabled={!canEdit}
                  defaultValue={initial("phone")}
                />
              </LField>
            </div>
            <div className="md:col-span-3">
              <LField label="Based airport" htmlFor="home_base">
                <LInput
                  id="home_base"
                  name="home_base"
                  placeholder="e.g. KTEB"
                  disabled={!canEdit}
                  defaultValue={initial("home_base")}
                />
              </LField>
            </div>

            <div className="md:col-span-6">
              <LField label="Certificate held" htmlFor={certTypeId}>
                <input
                  type="hidden"
                  name="certificate_type"
                  value={certType === NO_CERTIFICATE ? "" : certType}
                />
                <LSelect
                  id={certTypeId}
                  value={certType}
                  onChange={(e) => setCertType(e.target.value)}
                  disabled={!canEdit}
                >
                  {CERTIFICATE_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </LSelect>
              </LField>
            </div>
            <div className="md:col-span-6">
              <LField label="Certificate number" htmlFor="certificate_number">
                <LInput
                  id="certificate_number"
                  name="certificate_number"
                  disabled={!canEdit}
                  defaultValue={initial("certificate_number")}
                />
              </LField>
            </div>
            <div className="md:col-span-12">
              <LField
                label="Ratings & type ratings"
                htmlFor="ratings"
                hint="As written on your certificate, e.g. AMEL, Instrument Airplane, CE-525S"
              >
                <LInput
                  id="ratings"
                  name="ratings"
                  disabled={!canEdit}
                  defaultValue={initial("ratings")}
                />
              </LField>
            </div>

            <div className="md:col-span-3">
              <LField
                label="Default day rate"
                htmlFor="default_day_rate"
                hint="Per duty day flown"
              >
                <LInput
                  id="default_day_rate"
                  name="default_day_rate"
                  inputMode="decimal"
                  className="tnum-l"
                  disabled={!canEdit}
                  defaultValue={initial("default_day_rate")}
                />
              </LField>
            </div>
            <div className="md:col-span-3">
              <LField
                label="Travel day rate"
                htmlFor="default_travel_day_rate"
                hint="Often half to full day rate, your call"
              >
                <LInput
                  id="default_travel_day_rate"
                  name="default_travel_day_rate"
                  inputMode="decimal"
                  className="tnum-l"
                  disabled={!canEdit}
                  defaultValue={initial("default_travel_day_rate")}
                />
              </LField>
            </div>
            <div className="md:col-span-3">
              <LField
                label="Per diem"
                htmlFor="default_per_diem"
                hint="Daily, when you bill per diem instead of receipts"
              >
                <LInput
                  id="default_per_diem"
                  name="default_per_diem"
                  inputMode="decimal"
                  className="tnum-l"
                  disabled={!canEdit}
                  defaultValue={initial("default_per_diem")}
                />
              </LField>
            </div>
            <div className="md:col-span-3">
              <LField
                label="Payment terms (days)"
                htmlFor="default_payment_terms_days"
                hint="Net days on new clients"
              >
                <LInput
                  id="default_payment_terms_days"
                  name="default_payment_terms_days"
                  inputMode="numeric"
                  className="tnum-l"
                  disabled={!canEdit}
                  defaultValue={initial("default_payment_terms_days")}
                />
              </LField>
            </div>
          </div>

          <p className="text-caption text-ink-3">
            These seed new clients and new trips. Records you&rsquo;ve already
            created keep the rates they were saved with.
          </p>

          <div role="alert" aria-live="polite">
            {state.error ? (
              <p className="text-caption font-medium text-crit">{state.error}</p>
            ) : state.saved ? (
              <p className="text-caption font-medium text-good">Saved.</p>
            ) : null}
          </div>

          {canEdit ? (
            <div>
              <LButton type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save changes"}
              </LButton>
            </div>
          ) : (
            <p className="text-caption text-ink-3">
              Only the account owner can change these.
            </p>
          )}
        </div>
      </form>
    </LCard>
  );
}

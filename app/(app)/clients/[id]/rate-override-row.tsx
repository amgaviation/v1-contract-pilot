"use client";

import { useActionState } from "react";
import { lButtonClass } from "@/components/ledger";
import { LInput } from "@/components/ledger/forms";
import { centsToInput, formatCents } from "@/lib/format";
import { setClientRateOverride, type RateOverrideFormState } from "./rate-overrides-actions";

const initialState: RateOverrideFormState = { error: null };

export default function RateOverrideRow({
  clientId,
  dayTypeId,
  label,
  archived = false,
  defaultRateCents,
  overrideRateCents,
}: {
  clientId: string;
  dayTypeId: string;
  label: string;
  /** F10: this day type is archived but kept visible because an override
   * on it still exists — see RateOverridesPanel's filtering note. */
  archived?: boolean;
  defaultRateCents: number | null;
  overrideRateCents: number | null;
}) {
  const [state, formAction, pending] = useActionState(setClientRateOverride, initialState);

  // React 19 resets an uncontrolled form on every action dispatch, error
  // path included — echo the submitted rate back so a rejected save
  // doesn't blank what was typed.
  const rateValue =
    state.values?.rate !== undefined ? state.values.rate : centsToInput(overrideRateCents);

  return (
    <form action={formAction} className="flex flex-wrap items-start gap-4 py-3">
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="day_type_id" value={dayTypeId} />

      <div className="min-w-[180px] pt-1" style={{ flex: "1 1 180px" }}>
        <div className="text-body-s font-medium text-ink">{label}</div>
        <div className="text-caption text-ink-3">
          Default: {defaultRateCents === null ? "no rate agreed" : formatCents(defaultRateCents)}
        </div>
        {archived ? (
          <div className="text-caption text-warn">
            Archived, kept here only because this client still has an
            override on it
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`rate-${dayTypeId}`} className="text-body-s font-medium text-ink">
          Override (USD)
        </label>
        <LInput
          id={`rate-${dayTypeId}`}
          name="rate"
          inputMode="decimal"
          className="tnum-l"
          defaultValue={rateValue}
        />
        <span className="text-caption text-ink-3">Blank uses the default</span>
      </div>

      <div className="pt-6">
        <button type="submit" disabled={pending} className={lButtonClass({ variant: "outline" })}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="min-w-[80px] pt-6" role="alert" aria-live="polite">
        {state.error ? (
          <span className="text-caption font-medium text-crit">{state.error}</span>
        ) : state.saved ? (
          <span className="text-caption font-medium text-good">Saved.</span>
        ) : null}
      </div>
    </form>
  );
}

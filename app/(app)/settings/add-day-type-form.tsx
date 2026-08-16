"use client";

import { useActionState, useEffect, useState } from "react";
import { LButton, LCard, LSwitch } from "@/components/ledger";
import { LField, LInput, LSelect } from "@/components/ledger/forms";
import { createDayType, type DayTypeFormState } from "./day-types-actions";

const initialState: DayTypeFormState = { error: null };

const LINE_TYPE_OPTIONS = [
  { value: "flight_day", label: "Flight day line" },
  { value: "travel_day", label: "Travel day line" },
  { value: "other", label: "Other line" },
] as const;

export default function AddDayTypeForm() {
  const [state, formAction, pending] = useActionState(createDayType, initialState);

  // On success no `values` are echoed, so React 19's per-dispatch form
  // reset clears the fields for the next entry. On error they ARE
  // echoed, so a rejected add doesn't lose what was typed.
  const submitted = state.values;
  const initial = (key: string, fallback = "") => submitted?.[key] ?? fallback;
  const checked = (key: string, fallback: boolean) => {
    const echoed = submitted?.[key];
    return echoed === undefined ? fallback : echoed === "on";
  };

  // See the fix note in day-type-row.tsx: the select stays name-less and
  // controlled for display, and the real value posts from a controlled
  // hidden input, re-seeded from the echoed submission on a rejected add.
  const [invoiceLineType, setInvoiceLineType] = useState(() =>
    initial("invoice_line_type", "flight_day")
  );
  useEffect(() => {
    if (submitted?.invoice_line_type !== undefined) {
      setInvoiceLineType(String(submitted.invoice_line_type));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted]);

  return (
    <LCard>
      <form action={formAction}>
        <div className="flex flex-col gap-4">
          <h2 className="text-h3 font-semibold text-ink">Add a day type</h2>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-12">
            <LField
              label="Label"
              htmlFor="add-day-type-label"
              hint="Ground school day, for example"
              className="md:col-span-4"
            >
              <LInput
                id="add-day-type-label"
                name="label"
                required
                defaultValue={initial("label")}
              />
            </LField>

            <div className="flex items-center gap-2 md:col-span-2 md:self-end md:pb-2">
              <LSwitch
                name="billable"
                value="on"
                defaultChecked={checked("billable", true)}
                aria-label="Billable"
              />
              <span className="text-body-s text-ink-2">Billable</span>
            </div>

            <div className="flex items-center gap-2 md:col-span-2 md:self-end md:pb-2">
              <LSwitch
                name="counts_for_per_diem"
                value="on"
                defaultChecked={checked("counts_for_per_diem", true)}
                aria-label="Counts for per diem"
              />
              <span className="text-body-s text-ink-2">Per diem</span>
            </div>

            <LField
              label="Default rate (USD)"
              htmlFor="add-default-rate"
              hint="Optional"
              className="md:col-span-2"
            >
              <LInput
                id="add-default-rate"
                name="default_rate"
                inputMode="decimal"
                className="tnum-l"
                defaultValue={initial("default_rate")}
              />
            </LField>

            <LField
              label="Default rate fraction"
              htmlFor="add-default-units"
              hint="0.5 = half rate. Optional, defaults to full rate"
              className="md:col-span-2"
            >
              <LInput
                id="add-default-units"
                name="default_units"
                inputMode="decimal"
                placeholder="1"
                className="tnum-l"
                defaultValue={initial("default_units")}
              />
            </LField>

            <LField label="Bills as" htmlFor="add-bills-as" className="md:col-span-2">
              <LSelect
                id="add-bills-as"
                value={invoiceLineType}
                onChange={(e) => setInvoiceLineType(e.target.value)}
              >
                {LINE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </LSelect>
              <input type="hidden" name="invoice_line_type" value={invoiceLineType} />
            </LField>
          </div>

          <div role="alert" aria-live="polite">
            {state.error ? (
              <p className="text-caption font-medium text-crit">{state.error}</p>
            ) : state.saved ? (
              <p className="text-caption font-medium text-good">Added.</p>
            ) : null}
          </div>

          <div className="flex">
            <LButton type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add day type"}
            </LButton>
          </div>
        </div>
      </form>
    </LCard>
  );
}

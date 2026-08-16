"use client";

import { useActionState, useState } from "react";
import { LButton } from "@/components/ledger";
import { LField, LInput, LSelect } from "@/components/ledger/forms";
import { centsToInput } from "@/lib/format";
import { saveClientTaxForm, type TaxFormState } from "./actions";

const FORM_TYPES = [
  { value: "1099-NEC", label: "1099-NEC" },
  { value: "1099-MISC", label: "1099-MISC" },
  { value: "other", label: "Other" },
];

const initialState: TaxFormState = { error: null };

/**
 * The small form that records what a client's 1099 says, inline on the
 * year-end report. Collapsed by default — a pilot with a dozen clients
 * doesn't need a dozen open forms to read the delta column, only the
 * ability to fix the one that's wrong.
 */
export default function TaxFormEditor({
  clientId,
  clientName,
  year,
  existing,
}: {
  clientId: string;
  clientName: string;
  year: number;
  existing: {
    formType: string;
    reportedAmountCents: number;
    receivedOn: string | null;
    notes: string | null;
  } | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    saveClientTaxForm,
    initialState
  );
  const [formType, setFormType] = useState(existing?.formType ?? "1099-NEC");
  // A rejected submit must show and re-post what the pilot typed, not the
  // stored record — React 19 resets an uncontrolled form on every action
  // dispatch, error path included, so these three fields re-seed from the
  // action's echoed `state.values` and fall back to the stored record only
  // when there's no submission to echo yet.
  const submitted = state.values;

  if (!open) {
    return (
      <LButton
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        aria-label={`${existing ? "Edit" : "Record"} ${clientName}'s ${year} 1099`}
      >
        {existing ? "Edit" : "Record 1099"}
      </LButton>
    );
  }

  return (
    <div className="mt-2 rounded-control border border-hair-strong bg-card p-3">
      <form
        action={(formData) => {
          formData.set("form_type", formType);
          return formAction(formData);
        }}
      >
        <input type="hidden" name="client_id" value={clientId} />
        <input type="hidden" name="tax_year" value={year} />

        <div className="mb-2 text-body-s font-medium text-ink">
          {clientName} &middot; {year}
        </div>

        <div className="flex flex-col flex-wrap gap-3 sm:flex-row">
          <LField label="Form type" htmlFor={`form-type-${clientId}`} className="sm:w-40">
            <LSelect
              id={`form-type-${clientId}`}
              value={formType}
              onChange={(e) => setFormType(e.target.value)}
            >
              {FORM_TYPES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </LSelect>
          </LField>

          <LField label="Amount the form reports" htmlFor={`amount-${clientId}`} className="sm:w-36">
            <LInput
              id={`amount-${clientId}`}
              name="reported_amount"
              inputMode="decimal"
              placeholder="0.00"
              defaultValue={
                submitted
                  ? submitted.reported_amount
                  : existing
                    ? centsToInput(existing.reportedAmountCents)
                    : ""
              }
              required
              className="tnum-l"
            />
          </LField>

          <LField label="Received (optional)" htmlFor={`received-${clientId}`} className="sm:w-40">
            <LInput
              id={`received-${clientId}`}
              type="date"
              name="received_on"
              defaultValue={submitted ? submitted.received_on : existing?.receivedOn ?? ""}
            />
          </LField>

          <LField label="Notes (optional)" htmlFor={`notes-${clientId}`} className="flex-1">
            <LInput
              id={`notes-${clientId}`}
              name="notes"
              defaultValue={submitted ? submitted.notes : existing?.notes ?? ""}
              placeholder="e.g. corrected form received"
            />
          </LField>
        </div>

        <div className="mt-2" role="alert" aria-live="polite">
          {state.error ? <p className="text-caption font-medium text-crit">{state.error}</p> : null}
        </div>

        <div className="mt-3 flex gap-2">
          <LButton type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </LButton>
          <LButton
            type="button"
            size="sm"
            variant="quiet"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </LButton>
        </div>
      </form>
    </div>
  );
}

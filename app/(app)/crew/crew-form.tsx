"use client";

import { useActionState } from "react";
import NextLink from "next/link";
import { LAlert, LCard, lButtonClass } from "@/components/ledger";
import { LField, LInput, LTextarea } from "@/components/ledger/forms";
import type { CrewFormState } from "./actions";

export type CrewFormValues = {
  id?: string;
  name?: string | null;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  certificates?: string | null;
  notes?: string | null;
};

const initialState: CrewFormState = { error: null };

/**
 * Shared create/edit form. Every field here is plain text — unlike
 * client-form.tsx, nothing on this form is a <select> or checkbox, so
 * there is no controlled-state/genTick dance to work around React 19
 * resetting an uncontrolled form on a rejected submit. `initial()` below
 * is the one piece of that file's reasoning this form still needs: an
 * echoed submission wins over the stored row, so a rejected submit shows
 * what the pilot typed rather than blanking every field.
 */
export default function CrewForm({
  action,
  values = {},
  submitLabel,
}: {
  action: (
    state: CrewFormState,
    formData: FormData
  ) => Promise<CrewFormState>;
  values?: CrewFormValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  const submitted = state.values;
  const initial = (key: string, stored: unknown, fallback = "") => {
    const echoed = submitted?.[key];
    if (echoed !== undefined) return echoed;
    return stored === null || stored === undefined ? fallback : String(stored);
  };

  return (
    <LCard>
      <form action={formAction}>
        {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <LField label="Name" htmlFor="name">
            <LInput id="name" name="name" required defaultValue={initial("name", values.name)} />
          </LField>
          <LField label="Role" htmlFor="role" hint="PIC, SIC, flight attendant…">
            <LInput id="role" name="role" defaultValue={initial("role", values.role)} />
          </LField>
          <LField label="Email" htmlFor="email">
            <LInput
              id="email"
              type="email"
              name="email"
              defaultValue={initial("email", values.email)}
            />
          </LField>
          <LField label="Phone" htmlFor="phone">
            <LInput id="phone" name="phone" defaultValue={initial("phone", values.phone)} />
          </LField>
          <LField
            label="Certificates"
            htmlFor="certificates"
            className="md:col-span-2"
            hint="ATP, CFI, type ratings worth remembering."
          >
            <LInput
              id="certificates"
              name="certificates"
              defaultValue={initial("certificates", values.certificates)}
            />
          </LField>
          <LField label="Notes" htmlFor="notes" className="md:col-span-2">
            <LTextarea
              id="notes"
              name="notes"
              rows={3}
              defaultValue={initial("notes", values.notes)}
            />
          </LField>
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
          <NextLink href="/crew" className={lButtonClass({ variant: "outline" })}>
            Cancel
          </NextLink>
        </div>
      </form>
    </LCard>
  );
}

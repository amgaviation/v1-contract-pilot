"use client";

import { useActionState } from "react";
import { LButton, LCard } from "@/components/ledger";
import { LField, LInput } from "@/components/ledger/forms";
import { updateSettings, type SettingsFormState } from "./actions";

export type SettingsValues = {
  legal_name?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
};

const initialState: SettingsFormState = { error: null };

export default function SettingsForm({
  values,
  canEdit,
}: {
  values: SettingsValues;
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateSettings, initialState);

  // React 19 resets an uncontrolled form on every dispatch, error path
  // included, so a rejected submit would blank every field without this.
  const submitted = state.values;
  const initial = (key: keyof SettingsValues, fallback = "") => {
    const echoed = submitted?.[key];
    if (echoed !== undefined) return echoed;
    const stored = values[key];
    return stored === null || stored === undefined ? fallback : String(stored);
  };

  return (
    <LCard>
      <form action={formAction}>
        <div className="flex flex-col gap-4">
          <h2 className="text-h3 font-semibold">Your business</h2>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            {/* Full width now that the invoice prefix has moved to the
                Invoicing tab, where it sits beside the rest of the number
                format it is one third of. */}
            <div className="md:col-span-12">
              <LField
                label="Business name"
                htmlFor="legal_name"
                hint="Appears as the payee on every invoice"
              >
                <LInput
                  id="legal_name"
                  name="legal_name"
                  required
                  disabled={!canEdit}
                  defaultValue={initial("legal_name")}
                />
              </LField>
            </div>
            <div className="md:col-span-6">
              <LField label="Address" htmlFor="address_line1">
                <LInput
                  id="address_line1"
                  name="address_line1"
                  disabled={!canEdit}
                  defaultValue={initial("address_line1")}
                />
              </LField>
            </div>
            <div className="md:col-span-6">
              <LField label="Address line 2" htmlFor="address_line2">
                <LInput
                  id="address_line2"
                  name="address_line2"
                  disabled={!canEdit}
                  defaultValue={initial("address_line2")}
                />
              </LField>
            </div>
            <div className="md:col-span-4">
              <LField label="City" htmlFor="city">
                <LInput
                  id="city"
                  name="city"
                  disabled={!canEdit}
                  defaultValue={initial("city")}
                />
              </LField>
            </div>
            <div className="md:col-span-2">
              <LField label="State" htmlFor="state">
                <LInput
                  id="state"
                  name="state"
                  disabled={!canEdit}
                  defaultValue={initial("state")}
                />
              </LField>
            </div>
            <div className="md:col-span-3">
              <LField label="Postal code" htmlFor="postal_code">
                <LInput
                  id="postal_code"
                  name="postal_code"
                  disabled={!canEdit}
                  defaultValue={initial("postal_code")}
                />
              </LField>
            </div>
            <div className="md:col-span-3">
              <LField label="Country" htmlFor="country">
                <LInput
                  id="country"
                  name="country"
                  disabled={!canEdit}
                  defaultValue={initial("country")}
                />
              </LField>
            </div>
          </div>

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

"use client";

import { useActionState, useEffect, useState } from "react";
import { LButton, LCard } from "@/components/ledger";
import { LField, LInput, LSelect, LTextarea } from "@/components/ledger/forms";
import { formatDate } from "@/lib/format";
import { updateEstimateHeader, updateEstimateNotes, type EstimateFormState } from "../actions";

export type ClientOption = { id: string; name: string };

type EstimateForForm = {
  id: string;
  client_id: string;
  issued_on: string | null;
  valid_until: string | null;
  tax_rate_bps: number;
  terms: string | null;
  notes: string | null;
};

const initialState: EstimateFormState = { error: null };

export default function HeaderForm({
  estimate,
  clients,
  locked,
}: {
  estimate: EstimateForForm;
  clients: ClientOption[];
  locked: boolean;
}) {
  if (locked) {
    return <LockedHeader estimate={estimate} clients={clients} />;
  }
  return <DraftHeader estimate={estimate} clients={clients} />;
}

function DraftHeader({
  estimate,
  clients,
}: {
  estimate: EstimateForForm;
  clients: ClientOption[];
}) {
  const [state, formAction, pending] = useActionState(updateEstimateHeader, initialState);

  // Echoes the submitted values on a validation error — otherwise React 19
  // resets this uncontrolled form to the estimate's last-SAVED values on
  // every dispatch, including the error path, and the pilot's edits vanish
  // (same pattern as the invoice header form).
  const submitted = state.values;
  const initial = (key: string, stored: unknown, fallback = "") => {
    const echoed = submitted?.[key];
    if (echoed !== undefined) return echoed;
    return stored === null || stored === undefined ? fallback : String(stored);
  };

  // The Select posts through a controlled hidden input rather than its own
  // `name`, so a rejected submit re-seeds from the action's echo instead of
  // snapping back to whatever option happened to mount first — same fix as
  // every other Select in this product, now skinned as a real LSelect.
  const [clientId, setClientId] = useState(() => initial("client_id", estimate.client_id));
  useEffect(() => {
    if (submitted?.client_id !== undefined) setClientId(String(submitted.client_id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted]);

  return (
    <LCard>
      <form action={formAction}>
        <input type="hidden" name="id" value={estimate.id} />
        <p className="mb-3 text-lead font-bold text-ink">Quote details</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="flex flex-col gap-1 md:col-span-6">
            <label id="estimate-client-label" className="text-body-s font-medium text-ink">
              Client
            </label>
            <LSelect
              aria-labelledby="estimate-client-label"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </LSelect>
            <input type="hidden" name="client_id" value={clientId} />
          </div>
          <div className="md:col-span-3">
            <LField label="Valid until" htmlFor="valid_until" hint="How long the quote stands">
              <LInput
                id="valid_until"
                type="date"
                name="valid_until"
                defaultValue={initial("valid_until", estimate.valid_until)}
              />
            </LField>
          </div>
          <div className="md:col-span-3">
            <LField label="Tax rate (%)" htmlFor="tax_rate_percent">
              <LInput
                id="tax_rate_percent"
                name="tax_rate_percent"
                inputMode="decimal"
                defaultValue={initial(
                  "tax_rate_percent",
                  (estimate.tax_rate_bps / 100).toString()
                )}
              />
            </LField>
          </div>
          <div className="md:col-span-6">
            <LField label="Terms" htmlFor="terms">
              <LTextarea
                id="terms"
                name="terms"
                rows={3}
                defaultValue={initial("terms", estimate.terms)}
                placeholder="Cancellation terms, per-diem basis, what's not included…"
              />
            </LField>
          </div>
          <div className="md:col-span-6">
            <LField
              label="Notes"
              htmlFor="notes"
              hint="Carried onto the invoice if this estimate converts"
            >
              <LTextarea
                id="notes"
                name="notes"
                rows={3}
                defaultValue={initial("notes", estimate.notes)}
              />
            </LField>
          </div>
        </div>

        <div role="alert" aria-live="polite" className="mt-3">
          {state.error ? (
            <p className="text-caption font-medium text-crit">{state.error}</p>
          ) : state.saved ? (
            <p className="text-caption font-medium text-good">Saved.</p>
          ) : null}
        </div>

        {/* Outline, not filled — the detail page's one accent action is the
            live status-transition CTA in StatusActions; a routine data save
            here is secondary to it. */}
        <div className="mt-3">
          <LButton type="submit" variant="outline" disabled={pending}>
            {pending ? "Saving…" : "Save details"}
          </LButton>
        </div>
      </form>
    </LCard>
  );
}

/**
 * Once out of draft, the screen stops offering edits to what the client
 * was quoted — the way to change a sent estimate is "Revise" (back to
 * draft, edit, re-send), so what the client saw and what the pilot edited
 * never silently diverge. Notes stay editable in any status: they're the
 * pilot's own margin, not part of the quote. The database is looser here
 * on purpose (estimates_protect allows more than this form offers); this
 * is a UI discipline, not the enforcement.
 */
function LockedHeader({
  estimate,
  clients,
}: {
  estimate: EstimateForForm;
  clients: ClientOption[];
}) {
  const [state, formAction, pending] = useActionState(updateEstimateNotes, initialState);
  const clientName = clients.find((c) => c.id === estimate.client_id)?.name ?? "—";

  return (
    <LCard>
      <p className="mb-3 text-lead font-bold text-ink">Quote details</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
        <div className="flex flex-col gap-1 md:col-span-6">
          <p className="text-caption text-ink-3">Client</p>
          <p className="font-medium">{clientName}</p>
        </div>
        <div className="flex flex-col gap-1 md:col-span-3">
          <p className="text-caption text-ink-3">Sent</p>
          <p className="font-medium">{formatDate(estimate.issued_on)}</p>
        </div>
        <div className="flex flex-col gap-1 md:col-span-3">
          <p className="text-caption text-ink-3">Valid until</p>
          <p className="font-medium">{formatDate(estimate.valid_until)}</p>
        </div>
        <div className="flex flex-col gap-1 md:col-span-3">
          <p className="text-caption text-ink-3">Tax rate</p>
          <p className="tnum-l font-medium">{(estimate.tax_rate_bps / 100).toString()}%</p>
        </div>
        <div className="flex flex-col gap-1 md:col-span-9">
          <p className="text-caption text-ink-3">Terms</p>
          <p className="font-medium">{estimate.terms || "—"}</p>
        </div>
      </div>

      <form action={formAction} className="mt-3">
        <input type="hidden" name="id" value={estimate.id} />
        <LField label="Notes" htmlFor="notes-locked">
          <LTextarea id="notes-locked" name="notes" rows={2} defaultValue={estimate.notes ?? ""} />
        </LField>
        <p className="mt-1 text-caption text-ink-3">
          This estimate is out of draft. Revise it to change what the client
          sees. Notes are yours and stay editable.
        </p>
        <div role="alert" aria-live="polite" className="mt-2">
          {state.error ? (
            <p className="text-caption font-medium text-crit">{state.error}</p>
          ) : state.saved ? (
            <p className="text-caption font-medium text-good">Saved.</p>
          ) : null}
        </div>
        <div className="mt-2">
          <LButton type="submit" variant="outline" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save notes"}
          </LButton>
        </div>
      </form>
    </LCard>
  );
}

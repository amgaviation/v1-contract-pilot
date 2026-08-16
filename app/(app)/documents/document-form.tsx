"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import NextLink from "next/link";
import { LButton, LCard, lButtonClass } from "@/components/ledger";
import { LField, LInput, LSelect, LTextarea } from "@/components/ledger/forms";
import { cn } from "@/lib/ledger/cn";
import type { OptionChoice } from "@/lib/custom-options";
import { useFileSurvivesReset } from "@/components/use-file-survives-reset";
import type { DocumentFormState } from "./actions";

export type DocumentFormValues = {
  id?: string;
  kind?: string | null;
  label?: string | null;
  issued_on?: string | null;
  expires_on?: string | null;
  client_id?: string | null;
  notes?: string | null;
  file_path?: string | null;
};

export type ClientOption = {
  id: string;
  label: string;
};

// A native <select> forbids no empty-string value the way Radix's
// Select.Item did, but "No client" still needs a value distinguishable
// from "nothing chosen" for this form's own state, so the sentinel stays;
// wrappedAction below translates it back to "" before the server sees it.
const NO_CLIENT = "__none__";

const initialState: DocumentFormState = { error: null };

export default function DocumentForm({
  action,
  clients,
  kinds,
  values = {},
  submitLabel,
}: {
  action: (
    state: DocumentFormState,
    formData: FormData
  ) => Promise<DocumentFormState>;
  clients: ClientOption[];
  /**
   * The tenant's own document-kind vocabulary — their labels, their
   * order, retired kinds already dropped. Read server-side by the page
   * (lib/custom-options-read.ts) and passed in, rather than imported
   * here: this is a client component, and the options table can only be
   * read on the server. REQUIRED rather than optional, so a new screen
   * rendering this form cannot silently fall back to the stock list.
   */
  kinds: readonly OptionChoice[];
  values?: DocumentFormValues;
  submitLabel: string;
}) {
  async function wrappedAction(prevState: DocumentFormState, formData: FormData) {
    if (formData.get("client_id") === NO_CLIENT) formData.set("client_id", "");
    return action(prevState, formData);
  }
  const [state, formAction, pending] = useActionState(wrappedAction, initialState);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { fileName, lost: fileLost, onFileChange } = useFileSurvivesReset(fileInputRef);

  const submitted = state.values;
  const initial = (key: string, stored: unknown, fallback = "") => {
    const echoed = submitted?.[key];
    if (echoed !== undefined) return echoed;
    return stored === null || stored === undefined ? fallback : String(stored);
  };

  // Controlled, posted through their own hidden inputs rather than the
  // LSelects' own `name` — same posture invoices/estimates-new-form.tsx's
  // LineRow keeps for a real `<select>`: one posting mechanism, so the
  // server-visible form data stays provably identical across the Ledger
  // port rather than merely equivalent. React 19's post-action
  // form.reset() restores an uncontrolled control to its mount-time value
  // even on a rejected submit; these two stay controlled so they don't.
  const [kind, setKind] = useState(() => submitted?.kind ?? (values.kind ?? "other"));
  const [clientId, setClientId] = useState(() => {
    const stored = initial("client_id", values.client_id);
    return stored === "" ? NO_CLIENT : stored;
  });
  useEffect(() => {
    if (submitted?.kind !== undefined) setKind(String(submitted.kind || "other"));
    if (submitted?.client_id !== undefined) {
      setClientId(submitted.client_id ? String(submitted.client_id) : NO_CLIENT);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted]);

  return (
    <LCard>
      <form action={formAction}>
        <div className="flex flex-col gap-4">
          {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

          <h2 className="text-h3 font-semibold">What it is</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="flex flex-col gap-1">
              <label id="kind-label" className="text-body-s font-medium text-ink">
                Kind
              </label>
              <LSelect aria-labelledby="kind-label" value={kind} onChange={(e) => setKind(e.target.value)}>
                {kinds.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </LSelect>
              <input type="hidden" name="kind" value={kind} />
            </div>
            <LField
              label="Label"
              htmlFor="label"
              hint={'However you’d recognize it: e.g. "First class medical" or "N123AB hull policy"'}
              className="md:col-span-2"
            >
              <LInput id="label" name="label" required defaultValue={initial("label", values.label)} />
            </LField>
          </div>

          <h2 className="text-h3 font-semibold">Dates</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <LField label="Issued" htmlFor="issued_on" hint="Optional">
              <LInput
                id="issued_on"
                type="date"
                name="issued_on"
                className="tnum-l"
                defaultValue={initial("issued_on", values.issued_on)}
              />
            </LField>
            <LField
              label="Expires"
              htmlFor="expires_on"
              hint="Leave blank if this document doesn’t expire"
            >
              <LInput
                id="expires_on"
                type="date"
                name="expires_on"
                className="tnum-l"
                defaultValue={initial("expires_on", values.expires_on)}
              />
            </LField>
          </div>

          <h2 className="text-h3 font-semibold">Linked client</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label id="client-label" className="text-body-s font-medium text-ink">
                Client
              </label>
              <LSelect
                aria-labelledby="client-label"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              >
                <option value={NO_CLIENT}>No client</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.label}
                  </option>
                ))}
              </LSelect>
              <input type="hidden" name="client_id" value={clientId === NO_CLIENT ? "" : clientId} />
              <p className="text-caption text-ink-3">
                Optional: e.g. an insurance certificate or W-9 that names one client
              </p>
            </div>
            <LField label="Notes" htmlFor="notes">
              <LTextarea id="notes" name="notes" rows={2} defaultValue={initial("notes", values.notes)} />
            </LField>
          </div>

          <h2 className="text-h3 font-semibold">Scan or photo</h2>
          <div className="flex flex-col gap-1">
            {/* A plain file input: the file is stored privately and read back
                through a short-lived signed URL, never a public URL.
                The ref and onChange are what keep the chosen file attached
                across React 19's post-action form.reset() — without them a
                rejected submit on any OTHER field saved the document with
                no file while this screen still said one was attached. */}
            <input
              ref={fileInputRef}
              type="file"
              name="file"
              accept="image/jpeg,image/png,image/heic,image/webp,application/pdf"
              aria-label="Document scan or photo"
              onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
              className={cn(
                "text-body-s text-ink",
                "file:mr-3 file:rounded-control file:border file:border-hair-strong file:bg-card",
                "file:px-3 file:py-1.5 file:text-body-s file:font-medium file:text-ink",
                "hover:file:bg-sunk"
              )}
            />
            {fileLost ? (
              <p className="text-caption font-medium text-crit">
                This browser cleared the file you picked. Choose it again before
                saving. The rest of the form is as you left it.
              </p>
            ) : (
              <p className="text-caption text-ink-3">
                {fileName
                  ? `${fileName} will be attached.`
                  : values.file_path
                    ? "A file is already attached. Choosing a file replaces it."
                    : "JPEG, PNG, HEIC, WebP or PDF, up to 10 MB. Optional."}
              </p>
            )}
          </div>

          <div role="alert" aria-live="polite">
            {state.error ? <p className="text-caption font-medium text-crit">{state.error}</p> : null}
          </div>

          <div className="flex gap-3">
            <LButton type="submit" disabled={pending}>
              {pending ? "Saving…" : submitLabel}
            </LButton>
            <NextLink href="/documents" className={lButtonClass({ variant: "outline" })}>
              Cancel
            </NextLink>
          </div>
        </div>
      </form>
    </LCard>
  );
}

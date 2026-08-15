"use client";

import { useActionState, useEffect, useState } from "react";
import { LButton, LCard } from "@/components/ledger";
import { LField, LInput } from "@/components/ledger/forms";
import { formatDate } from "@/lib/format";
import { updateInvoiceHeader, updateInvoiceNotes, type InvoiceFormState } from "../actions";
import BillToFields, {
  TYPED_VALUE,
  type BillToValues,
  type ClientOption,
} from "../bill-to-fields";

export type { ClientOption };

type InvoiceForForm = {
  id: string;
  /** Null when this invoice bills the typed bill_to_* details instead. */
  client_id: string | null;
  bill_to_name: string | null;
  bill_to_contact_name: string | null;
  bill_to_email: string | null;
  bill_to_address_line1: string | null;
  bill_to_address_line2: string | null;
  bill_to_city: string | null;
  bill_to_state: string | null;
  bill_to_postal_code: string | null;
  bill_to_country: string | null;
  issued_on: string | null;
  due_on: string | null;
  tax_rate_bps: number;
  notes: string | null;
};

/** The stored bill-to columns as the form's controlled fields. */
function storedBillTo(invoice: InvoiceForForm): BillToValues {
  return {
    name: invoice.bill_to_name ?? "",
    contact_name: invoice.bill_to_contact_name ?? "",
    email: invoice.bill_to_email ?? "",
    address_line1: invoice.bill_to_address_line1 ?? "",
    address_line2: invoice.bill_to_address_line2 ?? "",
    city: invoice.bill_to_city ?? "",
    state: invoice.bill_to_state ?? "",
    postal_code: invoice.bill_to_postal_code ?? "",
    country: invoice.bill_to_country ?? "",
  };
}

/**
 * The address block as it prints, for the read-only view of an issued
 * invoice. Empty parts are dropped rather than rendered as blank lines.
 */
function billToLines(invoice: InvoiceForForm): string[] {
  const cityLine = [invoice.bill_to_city, invoice.bill_to_state]
    .filter((part) => part && part.trim() !== "")
    .join(", ");
  return [
    invoice.bill_to_contact_name,
    invoice.bill_to_address_line1,
    invoice.bill_to_address_line2,
    [cityLine, invoice.bill_to_postal_code].filter((part) => part && part.trim() !== "").join(" "),
    invoice.bill_to_country,
    invoice.bill_to_email,
  ].filter((line): line is string => typeof line === "string" && line.trim() !== "");
}

const initialState: InvoiceFormState = { error: null };

export default function HeaderForm({
  invoice,
  clients,
  locked,
}: {
  invoice: InvoiceForForm;
  clients: ClientOption[];
  locked: boolean;
}) {
  if (locked) {
    return <LockedHeader invoice={invoice} clients={clients} />;
  }
  return <DraftHeader invoice={invoice} clients={clients} />;
}

function DraftHeader({
  invoice,
  clients,
}: {
  invoice: InvoiceForForm;
  clients: ClientOption[];
}) {
  const [state, formAction, pending] = useActionState(updateInvoiceHeader, initialState);

  // Echoes the submitted values on a validation error — otherwise React 19
  // resets this uncontrolled form to `invoice`'s last-SAVED values on every
  // dispatch, including the error path, and the pilot's edits vanish.
  const submitted = state.values;
  const initial = (key: string, stored: unknown, fallback = "") => {
    const echoed = submitted?.[key];
    if (echoed !== undefined) return echoed;
    return stored === null || stored === undefined ? fallback : String(stored);
  };

  // BillToFields' own picker is a native, fully-controlled LSelect — no
  // `name` on the visible control at all, only on the hidden `client_id`/
  // `bill_to_mode` inputs it derives from `selection` — so this parent
  // still has to own that state and re-seed it on a rejected submit.
  // Without it, the native <select> would still participate directly in
  // the browser's own form "reset" event React 19 fires after every action
  // dispatch (including a rejected one), which restores whichever option
  // was selected at mount rather than the live value, silently
  // reassigning the invoice to the wrong client.
  const [selection, setSelection] = useState(() =>
    submitted?.bill_to_mode === "typed"
      ? TYPED_VALUE
      : submitted?.client_id !== undefined && submitted.client_id !== ""
        ? String(submitted.client_id)
        : (invoice.client_id ?? TYPED_VALUE)
  );
  // The typed block is controlled for the same reason the picker is: a
  // rejected submit must not silently discard a bill-to address the pilot
  // just typed.
  const [billTo, setBillTo] = useState<BillToValues>(() => storedBillTo(invoice));
  useEffect(() => {
    if (!submitted) return;
    setSelection(
      submitted.bill_to_mode === "typed"
        ? TYPED_VALUE
        : submitted.client_id
          ? String(submitted.client_id)
          : TYPED_VALUE
    );
    setBillTo({
      name: submitted.bill_to_name ?? "",
      contact_name: submitted.bill_to_contact_name ?? "",
      email: submitted.bill_to_email ?? "",
      address_line1: submitted.bill_to_address_line1 ?? "",
      address_line2: submitted.bill_to_address_line2 ?? "",
      city: submitted.bill_to_city ?? "",
      state: submitted.bill_to_state ?? "",
      postal_code: submitted.bill_to_postal_code ?? "",
      country: submitted.bill_to_country ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted]);

  return (
    <LCard>
      <form action={formAction}>
        <input type="hidden" name="id" value={invoice.id} />
        <div className="mb-3 text-h3 font-semibold">Billing details</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="flex flex-col gap-1 md:col-span-12">
            <BillToFields
              clients={clients}
              selection={selection}
              onSelectionChange={setSelection}
              values={billTo}
              onValueChange={(field, next) =>
                setBillTo((prev) => ({ ...prev, [field]: next }))
              }
            />
          </div>
          <div className="md:col-span-3">
            <LField label="Issue date" htmlFor="issued_on" hint="Defaults to today when sent">
              <LInput
                id="issued_on"
                type="date"
                name="issued_on"
                defaultValue={initial("issued_on", invoice.issued_on)}
              />
            </LField>
          </div>
          <div className="md:col-span-3">
            <LField
              label="Due date"
              htmlFor="due_on"
              hint={
                selection === TYPED_VALUE
                  ? "Defaults from your own terms in Settings, or 30 days"
                  : "Defaults from the client’s terms"
              }
            >
              <LInput
                id="due_on"
                type="date"
                name="due_on"
                defaultValue={initial("due_on", invoice.due_on)}
              />
            </LField>
          </div>
          <div className="md:col-span-4">
            <LField label="Tax rate (%)" htmlFor="tax_rate_percent">
              <LInput
                id="tax_rate_percent"
                name="tax_rate_percent"
                inputMode="decimal"
                defaultValue={initial(
                  "tax_rate_percent",
                  (invoice.tax_rate_bps / 100).toString()
                )}
              />
            </LField>
          </div>
          <div className="md:col-span-8">
            <LField label="Notes" htmlFor="notes">
              <LInput id="notes" name="notes" defaultValue={initial("notes", invoice.notes)} />
            </LField>
          </div>
        </div>

        <div className="mt-3" role="alert" aria-live="polite">
          {state.error ? (
            <p className="text-caption font-medium text-crit">{state.error}</p>
          ) : state.saved ? (
            <p className="text-caption font-medium text-good">Saved.</p>
          ) : null}
        </div>

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
 * Once issued, invoices_protect_issued only lets status/sent_at/
 * delivery_method/notes change at the database — the client/dates/tax
 * fields are shown read-only rather than as disabled inputs, because a
 * disabled control is a UI convention, not enforcement (the actual
 * enforcement is the trigger; this just keeps the screen honest about it).
 */
function LockedHeader({
  invoice,
  clients,
}: {
  invoice: InvoiceForForm;
  clients: ClientOption[];
}) {
  const [state, formAction, pending] = useActionState(updateInvoiceNotes, initialState);
  // An issued invoice's bill-to is frozen by invoices_protect_issued, so this
  // shows what it actually carries: the client's name when it has one, the
  // typed block when it does not. The typed block is printed in full here
  // because, unlike a client, there is no other screen it can be read on.
  const typed = invoice.client_id === null;
  const clientName = typed
    ? invoice.bill_to_name ?? "No client"
    : clients.find((c) => c.id === invoice.client_id)?.name ?? "Unknown client";
  const typedLines = typed ? billToLines(invoice) : [];

  return (
    <LCard>
      <div className="mb-3 text-h3 font-semibold">Billing details</div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
        <div className="flex flex-col gap-1 md:col-span-6">
          <span className="text-caption text-ink-3">Bill to</span>
          <span className="font-medium">{clientName}</span>
          {typedLines.map((line) => (
            <span key={line} className="text-caption text-ink-3">
              {line}
            </span>
          ))}
        </div>
        <div className="flex flex-col gap-1 md:col-span-3">
          <span className="text-caption text-ink-3">Issued</span>
          <span className="font-medium">{formatDate(invoice.issued_on)}</span>
        </div>
        <div className="flex flex-col gap-1 md:col-span-3">
          <span className="text-caption text-ink-3">Due</span>
          <span className="font-medium">{formatDate(invoice.due_on)}</span>
        </div>
      </div>

      <form action={formAction} className="mt-3">
        <input type="hidden" name="id" value={invoice.id} />
        <LField
          label="Notes"
          htmlFor="notes-locked"
          hint="This is issued. Only notes and delivery status can still change."
        >
          <LInput id="notes-locked" name="notes" defaultValue={invoice.notes ?? ""} />
        </LField>
        <div className="mt-2" role="alert" aria-live="polite">
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

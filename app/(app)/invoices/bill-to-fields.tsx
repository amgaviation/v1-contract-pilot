"use client";

import { LField, LInput, LSelect } from "@/components/ledger/forms";

/**
 * WHO AN INVOICE BILLS, ASKED ONCE, IN ONE CONTROL.
 *
 * Shared by the new-invoice form and the invoice screen's header form, so the
 * two cannot ask the question differently or post different field names to the
 * one server-side reader (readBillTo in ../actions.ts).
 *
 * ONE PICKER, NOT A MODE SWITCH BESIDE A PICKER. The question a pilot is
 * answering is "who is this for", and "a saved client" versus "somebody I will
 * type in" is an answer to that question, not a separate setting about it. So
 * the clientless option is the first item in the same list the clients are in.
 * A radio pair above the picker would make the pilot answer twice.
 *
 * TYPED_VALUE is a sentinel: it is prefixed and bracketed so it cannot
 * collide with a UUID, and it never reaches the database — the form posts
 * `bill_to_mode`, and `client_id` is posted empty whenever the sentinel is
 * selected. It also keeps the clientless choice distinguishable from
 * "nothing chosen yet" (the empty string), which the picker below — a native
 * `<select>` (components/ledger/forms.tsx's LSelect, per the migration's
 * "native controls survive" rule) — represents with its own leading,
 * disabled placeholder option.
 */

export const TYPED_VALUE = "__typed__";

export type ClientOption = { id: string; name: string };

export type BillToValues = {
  name: string;
  contact_name: string;
  email: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
};

export const EMPTY_BILL_TO: BillToValues = {
  name: "",
  contact_name: "",
  email: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  postal_code: "",
  country: "",
};

export default function BillToFields({
  clients,
  selection,
  onSelectionChange,
  values,
  onValueChange,
  /**
   * Rendered under the picker when a client is chosen. The new-invoice form
   * uses it to explain the empty-client-list case; the header form has
   * nothing to add.
   */
  clientHint,
}: {
  clients: ClientOption[];
  /** A client id, or TYPED_VALUE. */
  selection: string;
  onSelectionChange: (next: string) => void;
  values: BillToValues;
  onValueChange: (field: keyof BillToValues, next: string) => void;
  clientHint?: string;
}) {
  const typed = selection === TYPED_VALUE;

  return (
    <div className="flex flex-col gap-3">
      <LField
        label="Bill to"
        htmlFor="bill-to"
        hint={
          typed
            ? "This invoice keeps these details. No rate card, no minimum, no late fee and no reminder schedule applies to it."
            : clientHint
        }
      >
        <LSelect
          id="bill-to"
          value={selection}
          onChange={(e) => onSelectionChange(e.target.value)}
        >
          <option value="" disabled>
            Choose who this bills
          </option>
          <option value={TYPED_VALUE}>No client, type the details</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </LSelect>
      </LField>
      {/* The posted values. `bill_to_mode` is what readBillTo branches on,
          rather than inferring the mode from which fields are filled: a
          cleared name and a form that failed to post are otherwise the same
          submission. */}
      <input type="hidden" name="bill_to_mode" value={typed ? "typed" : "client"} />
      <input type="hidden" name="client_id" value={typed ? "" : selection} />

      {typed ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <Field
            span="md:col-span-6"
            name="bill_to_name"
            label="Name"
            hint="Who pays this. Required."
            value={values.name}
            onChange={(next) => onValueChange("name", next)}
          />
          <Field
            span="md:col-span-6"
            name="bill_to_contact_name"
            label="Contact"
            value={values.contact_name}
            onChange={(next) => onValueChange("contact_name", next)}
          />
          <Field
            span="md:col-span-6"
            name="bill_to_email"
            label="Email"
            hint="Where an emailed copy goes. Leave it blank and you send the PDF yourself."
            value={values.email}
            onChange={(next) => onValueChange("email", next)}
          />
          <Field
            span="md:col-span-6"
            name="bill_to_address_line1"
            label="Address"
            value={values.address_line1}
            onChange={(next) => onValueChange("address_line1", next)}
          />
          <Field
            span="md:col-span-6"
            name="bill_to_address_line2"
            label="Address line 2"
            value={values.address_line2}
            onChange={(next) => onValueChange("address_line2", next)}
          />
          <Field
            span="md:col-span-4"
            name="bill_to_city"
            label="City"
            value={values.city}
            onChange={(next) => onValueChange("city", next)}
          />
          <Field
            span="md:col-span-2"
            name="bill_to_state"
            label="State"
            value={values.state}
            onChange={(next) => onValueChange("state", next)}
          />
          <Field
            span="md:col-span-3"
            name="bill_to_postal_code"
            label="Postal code"
            value={values.postal_code}
            onChange={(next) => onValueChange("postal_code", next)}
          />
          <Field
            span="md:col-span-3"
            name="bill_to_country"
            label="Country"
            value={values.country}
            onChange={(next) => onValueChange("country", next)}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * CONTROLLED, every one of them. React 19 resets an uncontrolled form on every
 * action dispatch including the rejected path, and these fields are the only
 * record of who the invoice bills: losing them on a validation error means
 * retyping an address. The parent owns the state and re-seeds it from the
 * action's echoed values.
 *
 * `span` is a literal Tailwind class (e.g. "md:col-span-6"), not assembled
 * from a template string — Tailwind's build-time scanner has to see the
 * whole class name at the call site to generate it.
 */
function Field({
  span,
  name,
  label,
  hint,
  value,
  onChange,
}: {
  span: string;
  name: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <LField label={label} htmlFor={name} hint={hint} className={span}>
      <LInput id={name} name={name} value={value} onChange={(e) => onChange(e.target.value)} />
    </LField>
  );
}

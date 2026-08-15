"use client";

import { Flex, Grid, Select, Text, TextField } from "@/components/ui";

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
 * TYPED_VALUE is a sentinel because Radix Select forbids an empty item value.
 * It is prefixed and bracketed so it cannot collide with a UUID, and it never
 * reaches the database: the form posts `bill_to_mode`, and `client_id` is
 * posted empty whenever the sentinel is selected.
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
    <Flex direction="column" gap="3">
      <Flex direction="column" gap="1">
        <Text as="label" size="2" weight="medium" id="bill-to-label">
          Bill to
        </Text>
        <Select.Root
          value={selection || undefined}
          onValueChange={onSelectionChange}
        >
          <Select.Trigger
            id="bill-to"
            aria-labelledby="bill-to-label"
            placeholder="Choose who this bills"
          />
          <Select.Content>
            <Select.Item value={TYPED_VALUE}>No client, type the details</Select.Item>
            {clients.map((client) => (
              <Select.Item key={client.id} value={client.id}>
                {client.name}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
        {/* The posted values. `bill_to_mode` is what readBillTo branches on,
            rather than inferring the mode from which fields are filled: a
            cleared name and a form that failed to post are otherwise the same
            submission. */}
        <input type="hidden" name="bill_to_mode" value={typed ? "typed" : "client"} />
        <input type="hidden" name="client_id" value={typed ? "" : selection} />
        {typed ? (
          <Text size="1" color="gray">
            This invoice keeps these details. No rate card, no minimum, no late
            fee and no reminder schedule applies to it.
          </Text>
        ) : clientHint ? (
          <Text size="1" color="gray">
            {clientHint}
          </Text>
        ) : null}
      </Flex>

      {typed ? (
        <Grid columns={{ initial: "1", md: "12" }} gap="3">
          <Field
            span="6"
            name="bill_to_name"
            label="Name"
            hint="Who pays this. Required."
            value={values.name}
            onChange={(next) => onValueChange("name", next)}
          />
          <Field
            span="6"
            name="bill_to_contact_name"
            label="Contact"
            value={values.contact_name}
            onChange={(next) => onValueChange("contact_name", next)}
          />
          <Field
            span="6"
            name="bill_to_email"
            label="Email"
            hint="Where an emailed copy goes. Leave it blank and you send the PDF yourself."
            value={values.email}
            onChange={(next) => onValueChange("email", next)}
          />
          <Field
            span="6"
            name="bill_to_address_line1"
            label="Address"
            value={values.address_line1}
            onChange={(next) => onValueChange("address_line1", next)}
          />
          <Field
            span="6"
            name="bill_to_address_line2"
            label="Address line 2"
            value={values.address_line2}
            onChange={(next) => onValueChange("address_line2", next)}
          />
          <Field
            span="4"
            name="bill_to_city"
            label="City"
            value={values.city}
            onChange={(next) => onValueChange("city", next)}
          />
          <Field
            span="2"
            name="bill_to_state"
            label="State"
            value={values.state}
            onChange={(next) => onValueChange("state", next)}
          />
          <Field
            span="3"
            name="bill_to_postal_code"
            label="Postal code"
            value={values.postal_code}
            onChange={(next) => onValueChange("postal_code", next)}
          />
          <Field
            span="3"
            name="bill_to_country"
            label="Country"
            value={values.country}
            onChange={(next) => onValueChange("country", next)}
          />
        </Grid>
      ) : null}
    </Flex>
  );
}

/**
 * CONTROLLED, every one of them. React 19 resets an uncontrolled form on every
 * action dispatch including the rejected path, and these fields are the only
 * record of who the invoice bills: losing them on a validation error means
 * retyping an address. The parent owns the state and re-seeds it from the
 * action's echoed values.
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
    <Flex direction="column" gap="1" gridColumn={{ md: `span ${span}` }}>
      <Text as="label" size="2" weight="medium" htmlFor={name}>
        {label}
      </Text>
      <TextField.Root
        id={name}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? (
        <Text size="1" color="gray">
          {hint}
        </Text>
      ) : null}
    </Flex>
  );
}

"use client";

import { useActionState, useState } from "react";
import { Box, Button, Flex, Select, Text, TextField } from "@/components/ui";
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
      <Button
        size="1"
        variant="soft"
        onClick={() => setOpen(true)}
        aria-label={`${existing ? "Edit" : "Record"} ${clientName}'s ${year} 1099`}
      >
        {existing ? "Edit" : "Record 1099"}
      </Button>
    );
  }

  return (
    <Box
      style={{
        border: "1px solid var(--gray-a5)",
        borderRadius: "var(--radius-3)",
      }}
      p="3"
      mt="2"
    >
      <form
        action={(formData) => {
          formData.set("form_type", formType);
          return formAction(formData);
        }}
      >
        <input type="hidden" name="client_id" value={clientId} />
        <input type="hidden" name="tax_year" value={year} />

        <Text as="div" size="2" weight="medium" mb="2">
          {clientName} &middot; {year}
        </Text>

        <Flex direction={{ initial: "column", sm: "row" }} gap="3" wrap="wrap">
          <Flex direction="column" gap="1">
            <Text as="label" size="1" color="gray" id={`form-type-${clientId}`}>
              Form type
            </Text>
            <Select.Root value={formType} onValueChange={setFormType}>
              <Select.Trigger aria-labelledby={`form-type-${clientId}`} />
              <Select.Content>
                {FORM_TYPES.map((f) => (
                  <Select.Item key={f.value} value={f.value}>
                    {f.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Flex>

          <Flex direction="column" gap="1">
            <Text as="label" size="1" color="gray" htmlFor={`amount-${clientId}`}>
              Amount the form reports
            </Text>
            <TextField.Root
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
              style={{ width: "9rem" }}
            />
          </Flex>

          <Flex direction="column" gap="1">
            <Text as="label" size="1" color="gray" htmlFor={`received-${clientId}`}>
              Received (optional)
            </Text>
            <TextField.Root
              id={`received-${clientId}`}
              type="date"
              name="received_on"
              defaultValue={submitted ? submitted.received_on : existing?.receivedOn ?? ""}
              style={{ width: "10rem" }}
            />
          </Flex>

          <Flex direction="column" gap="1" flexGrow="1">
            <Text as="label" size="1" color="gray" htmlFor={`notes-${clientId}`}>
              Notes (optional)
            </Text>
            <TextField.Root
              id={`notes-${clientId}`}
              name="notes"
              defaultValue={submitted ? submitted.notes : existing?.notes ?? ""}
              placeholder="e.g. corrected form received"
            />
          </Flex>
        </Flex>

        {state.error ? (
          <Text as="div" size="1" color="red" mt="2" role="alert">
            {state.error}
          </Text>
        ) : null}

        <Flex gap="2" mt="3">
          <Button type="submit" size="1" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            size="1"
            variant="soft"
            color="gray"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
        </Flex>
      </form>
    </Box>
  );
}

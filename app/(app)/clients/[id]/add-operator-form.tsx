"use client";

import { useActionState } from "react";
import { Button, Callout, Flex, Text, TextField } from "@/components/ui";
import { COUNTERPARTY_COPY } from "@/lib/counterparty";
import {
  createOperatorCounterparty,
  type OperatorFormState,
} from "./operator-qualifications-actions";

const initialState: OperatorFormState = { error: null };

/**
 * One field, because pilot.clients requires one field. See
 * createOperatorCounterparty's comment for why the billing form is the
 * wrong thing to make somebody fill in to record a training event.
 */
export default function AddOperatorForm() {
  const [state, formAction, pending] = useActionState(
    createOperatorCounterparty,
    initialState
  );

  return (
    <form action={formAction}>
      <Text as="div" size="2" weight="medium" mb="1">
        {COUNTERPARTY_COPY.addOperatorHeading}
      </Text>
      <Text as="div" size="1" color="gray" mb="2">
        {COUNTERPARTY_COPY.addOperatorHelp}
      </Text>
      {state.error ? (
        <Callout.Root color="red" size="1" mb="2">
          <Callout.Text>{state.error}</Callout.Text>
        </Callout.Root>
      ) : null}
      <Flex gap="2" align="end" wrap="wrap">
        <Flex direction="column" gap="1">
          <Text as="label" size="1" color="gray" htmlFor="new-operator-name">
            Operator name
          </Text>
          <TextField.Root
            id="new-operator-name"
            name="name"
            required
            defaultValue={state.name ?? ""}
            placeholder="Sierra Air Charter"
          />
        </Flex>
        <Button type="submit" variant="soft" disabled={pending}>
          {pending ? "Adding..." : COUNTERPARTY_COPY.addOperatorSubmit}
        </Button>
      </Flex>
    </form>
  );
}
